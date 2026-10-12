// Which workflow TAB a run's result belongs to.
//
// A run keeps going when you switch to another workflow tab. When it ends, the
// server's `executed` message names only a node id, and ids repeat across
// workflows, so a node that looks itself up in the OPEN tab (app.graph /
// core's node.onExecuted) misses its own result AND paints it on another
// workflow's node that happens to have the same id (Discord 2026-10, Preview
// Image and Image Compare kept the old picture).
//
// Core already does it right for its own nodes: it files every result under
// the tab that queued the run (ChangeTracker: workflow.changeTracker
// .nodeOutputs[node id] = the SAME output object) and hands them back when that
// tab opens again, through the `onNodeOutputsUpdated` extension hook
// (ChangeTracker.restore -> restoreOutputs -> app.nodeOutputs). These helpers
// let a node follow the same rule:
//   runTab(output)            "active" | "other" | "unknown"; call it from a
//                             microtask queued in the executed handler, so
//                             core's own listener has filed the output first.
//   eachRestoredOutput(...)   for an onNodeOutputsUpdated hook: the restored
//                             outputs of one node type, minus results of other
//                             tabs that core's store kept for the tab that was
//                             open when they ended.
// Anything this cannot place (a run queued from another browser or the API,
// an older frontend without these fields) answers "unknown" and the caller
// keeps its old behaviour.
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const MAX_OWNERS = 2000;
const owners = new Map(); // "type/subfolder/filename" -> the workflow that queued the run (this page session)

function filesOf(output) {
  const out = [];
  if (!output || typeof output !== "object") return out;
  for (const v of Object.values(output)) {
    if (!Array.isArray(v)) continue;
    for (const f of v) {
      if (f && typeof f === "object" && typeof f.filename === "string") {
        out.push(`${f.type || ""}/${f.subfolder || ""}/${f.filename}`);
      }
    }
  }
  return out;
}

function trackerHolds(workflow, output) {
  const outs = workflow?.changeTracker?.nodeOutputs;
  if (!outs || typeof outs !== "object") return false;
  for (const v of Object.values(outs)) {
    if (v === output) return true;
    // A merged result (detail.merge) is a new object holding the same items.
    for (const k in output) {
      const first = Array.isArray(output[k]) ? output[k][0] : undefined;
      if (first && typeof first === "object" && Array.isArray(v?.[k]) && v[k].includes(first)) return true;
    }
  }
  return false;
}

function ownerOf(output) {
  const ws = app.extensionManager?.workflow;
  if (!output || typeof output !== "object" || !ws) return null;
  // The open tab too: it can be missing from openWorkflows (seen after every
  // tab was closed).
  for (const w of new Set([ws.activeWorkflow, ...(ws.openWorkflows || [])])) {
    if (w && trackerHolds(w, output)) return w;
  }
  return null;
}

function remember(output, owner) {
  for (const f of filesOf(output)) {
    owners.delete(f);
    owners.set(f, owner);
  }
  while (owners.size > MAX_OWNERS) owners.delete(owners.keys().next().value);
}

// Every run, not only the ones a Pixaroma node looks at: a restored output is
// judged by these records (restoreOutputs hands back clones, so the identity
// test above no longer works there).
api.addEventListener("executed", ({ detail }) => {
  const output = detail?.output;
  if (!output || typeof output !== "object") return;
  queueMicrotask(() => {
    const owner = ownerOf(output);
    if (owner) remember(output, owner);
  });
});

export function runTab(output) {
  const owner = ownerOf(output);
  if (!owner) return "unknown";
  remember(output, owner);
  return owner === app.extensionManager?.workflow?.activeWorkflow ? "active" : "other";
}

function restoredFromOtherTab(output) {
  const active = app.extensionManager?.workflow?.activeWorkflow;
  for (const f of filesOf(output)) {
    const w = owners.get(f);
    if (w && w !== active) return true;
  }
  return false;
}

// The node an onNodeOutputsUpdated key names: "id" on the root graph, or
// "<subgraph uuid>:<id>" inside a subgraph.
function nodeByLocator(locatorId) {
  const root = app.rootGraph || app.graph;
  const id = String(locatorId);
  const i = id.lastIndexOf(":");
  if (i < 0) return root?.getNodeById?.(id) ?? null;
  return root?.subgraphs?.get?.(id.slice(0, i))?.getNodeById?.(id.slice(i + 1)) ?? null;
}

export function eachRestoredOutput(nodeOutputs, comfyClass, fn) {
  if (!nodeOutputs || typeof nodeOutputs !== "object") return;
  for (const [locatorId, output] of Object.entries(nodeOutputs)) {
    if (!output || typeof output !== "object") continue;
    const node = nodeByLocator(locatorId);
    if (!node || (node.comfyClass || node.type) !== comfyClass) continue;
    if (restoredFromOtherTab(output)) continue;
    fn(node, output);
  }
}
